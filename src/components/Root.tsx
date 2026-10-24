import {Route, Routes} from "react-router";
import Nav from "../components/Nav";
import Gallery from "../pages/Gallery.tsx";
import Paint from "../pages/Paint";

export default function Root(){
    return(
        <>
            <Nav/>
            <Routes>
                <Route path="/" element={<Nav/>}/>
                <Route path="/paint" element={<Paint/>}/>
                <Route path="/gallery" element={<Gallery/>}/>
            </Routes>
        </>
    )
}