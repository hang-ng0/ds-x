import {Route, Routes} from "react-router";
import Nav from "../components/Nav";
import Gallery from "../pages/Gallery.tsx";
import Paint from "../pages/Paint";
import Home from "../pages/Home";
import Header from "./Header.tsx";
import GlobalStyle from "./GlobalStyle.tsx";
import styled from "styled-components";

const SiteBar = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2%;
    background-color: #fff2e2;
    
    border-bottom: 4px dashed #2a7099;

    @media (max-width: 520px) {
        align-items: flex-start;
        flex-direction: column;
    }
`;

export default function Root(){
    return(
        <>
            <GlobalStyle />

            <SiteBar>
                <Header />
                <Nav />
            </SiteBar>

            <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/paint" element={<Paint />} />
                <Route path="/gallery" element={<Gallery />} />
            </Routes>
        </>
    )
}