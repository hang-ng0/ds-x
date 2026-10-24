import {Route, Routes} from "react-router";
import Nav from "../components/Nav";
import Gallery from "../pages/Gallery.tsx";
import Paint from "../pages/Paint";
import Home from "../pages/Home";

export default function Root(){
    return(
        <>
            <Routes>
                <Route path="/" element={
                    <>
                        <Home/>
                    </>
                }/>
                <Route path="/paint" element={
                    <>
                        <Nav />
                        <Paint/>
                    </>
                }/>
                <Route path="/gallery" element={
                    <>
                        <Nav />
                        <Gallery/>
                    </>
                }/>
            </Routes>
        </>
    )
}